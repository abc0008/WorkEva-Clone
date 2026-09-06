"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  fileId: string;
  page: number;
  zoom: number;
  onError?: (message: string) => void;
};

/**
 * The small surface of pdf.js used by this component. Keeping these types
 * local lets the pdf.js module stay a client-only dynamic import (and keeps
 * the component from trying to construct a worker during server rendering).
 */
type PdfViewport = { width: number; height: number };
type PdfRenderTask = { promise: Promise<void>; cancel: () => void };
type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }) => PdfRenderTask;
};
type PdfDocument = {
  getPage: (page: number) => Promise<PdfPage>;
  destroy: () => Promise<void> | void;
};
type PdfLoadingTask = {
  promise: Promise<PdfDocument>;
  destroy: () => Promise<void> | void;
};
type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: { data: Uint8Array }) => PdfLoadingTask;
};

type LoadState = "loading" | "ready" | "error";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isCancellation(error: unknown): boolean {
  if (!error) return false;
  const name =
    typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  return (
    name === "AbortError" ||
    name === "RenderingCancelledException" ||
    name === "AbortException"
  );
}

/** Render one page of an authorized PDF without relying on the browser PDF plugin. */
export function PdfViewer({ fileId, page, zoom, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onErrorRef = useRef(onError);
  const [containerWidth, setContainerWidth] = useState(0);
  const [documentProxy, setDocumentProxy] = useState<PdfDocument | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Observe the actual content width so a page remains usable in the narrow
  // review layout and on mobile. Only state changes when the width changes,
  // which prevents ResizeObserver/render feedback loops.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const nextWidth = Math.max(0, Math.round(container.clientWidth));
      setContainerWidth((previous) =>
        previous === nextWidth ? previous : nextWidth,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Fetch and parse the source once per file. The fetched bytes are copied
  // before handing them to pdf.js because its worker may transfer and detach
  // the Uint8Array's underlying ArrayBuffer.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let loadingTask: PdfLoadingTask | undefined;
    let loadedDocument: PdfDocument | undefined;

    setDocumentProxy(null);
    setState("loading");
    setMessage("");

    const load = async () => {
      try {
        const pdfjs = (await import("pdfjs-dist")) as unknown as PdfJs;
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const response = await fetch(
          `/api/files/${encodeURIComponent(fileId)}`,
          {
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
            headers: { Accept: "application/pdf" },
          },
        );
        if (!response.ok)
          throw new Error(`Unable to load document (HTTP ${response.status}).`);
        const sourceBytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;

        // pdf.js may transfer this buffer to its worker. Passing a copy keeps
        // the fetched source intact if a later operation needs to retry.
        loadingTask = pdfjs.getDocument({ data: sourceBytes.slice() });
        loadedDocument = await loadingTask.promise;
        if (cancelled) {
          await Promise.resolve(loadingTask?.destroy()).catch(() => undefined);
          return;
        }
        setDocumentProxy(loadedDocument);
      } catch (error) {
        if (cancelled || controller.signal.aborted || isCancellation(error))
          return;
        const nextMessage = errorMessage(
          error,
          "Unable to load the PDF document.",
        );
        setState("error");
        setMessage(nextMessage);
        onErrorRef.current?.(nextMessage);
      }
    };
    void load();

    return () => {
      cancelled = true;
      controller.abort();
      if (loadingTask)
        void Promise.resolve(loadingTask.destroy()).catch(() => undefined);
    };
  }, [fileId]);

  // Render is independently cancellable, so changing page or zoom never
  // leaves an older render writing into the canvas after the new one starts.
  useEffect(() => {
    if (!documentProxy) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    let cancelled = false;
    let renderTask: PdfRenderTask | undefined;

    setState("loading");
    setMessage("");

    const render = async () => {
      try {
        const pdfPage = await documentProxy.getPage(Math.max(1, page));
        if (cancelled) return;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const availableWidth =
          containerWidth > 0 ? containerWidth : baseViewport.width;
        const requestedZoom = Number.isFinite(zoom) ? Math.max(1, zoom) : 100;
        const scale = Math.max(
          0.01,
          (availableWidth / baseViewport.width) * (requestedZoom / 100),
        );
        const cssViewport = pdfPage.getViewport({ scale });
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const renderViewport = pdfPage.getViewport({ scale: scale * dpr });
        const context = canvas.getContext("2d");
        if (!context)
          throw new Error("This browser cannot render a PDF canvas.");

        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));
        canvas.style.width = `${Math.max(1, cssViewport.width)}px`;
        canvas.style.height = `${Math.max(1, cssViewport.height)}px`;
        context.clearRect(0, 0, canvas.width, canvas.height);
        renderTask = pdfPage.render({
          canvasContext: context,
          viewport: renderViewport,
        });
        await renderTask.promise;
        if (!cancelled) setState("ready");
      } catch (error) {
        if (cancelled || isCancellation(error)) return;
        const nextMessage = errorMessage(
          error,
          "Unable to render this PDF page.",
        );
        setState("error");
        setMessage(nextMessage);
        onErrorRef.current?.(nextMessage);
      }
    };
    void render();

    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [documentProxy, page, zoom, containerWidth]);

  const originalHref = `/api/files/${encodeURIComponent(fileId)}`;
  return (
    <div
      ref={containerRef}
      aria-busy={state === "loading"}
      style={{
        position: "relative",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`PDF page ${Math.max(1, page)}`}
        style={{
          display: state === "error" ? "none" : "block",
          maxWidth: "none",
          background: "#fff",
          boxShadow: "0 2px 8px rgba(15,32,56,.2)",
        }}
      />
      {state === "loading" && (
        <div
          role="status"
          style={{
            position: "absolute",
            top: 0,
            padding: 28,
            color: "#62748a",
            background: "#fff",
          }}
        >
          Loading document…
        </div>
      )}
      {state === "error" && (
        <div
          role="alert"
          style={{
            maxWidth: 460,
            padding: 22,
            color: "#8b2a20",
            textAlign: "center",
          }}
        >
          <div>{message || "Unable to display this document."}</div>
          <a
            href={originalHref}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block",
              marginTop: 10,
              color: "#087a5d",
              fontWeight: 600,
            }}
          >
            Open original document
          </a>
        </div>
      )}
    </div>
  );
}
