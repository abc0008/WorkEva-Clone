"use client";
import { useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Dependency, WorkflowNode } from "@/lib/types";

type Props = {
  nodes: WorkflowNode[];
  edges: Dependency[];
  selectedId?: string;
  readonly?: boolean;
  onSelect?: (id: string) => void;
  onNodes?: (nodes: WorkflowNode[]) => void;
  onEdges?: (edges: Dependency[]) => void;
};
export function FlowCanvas({
  nodes,
  edges,
  selectedId,
  readonly = false,
  onSelect,
  onNodes,
  onEdges,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const flow = useRef<() => void>(null);
  useEffect(() => {
    if (!container.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        flow.current?.();
      });
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div
      ref={container}
      className="we-flow-surface"
      style={{ height: 580, width: "100%", minWidth: 0 }}
    >
      <ReactFlow
        onInit={(instance) => {
          flow.current = () => {
            void instance.fitView({ padding: 0.15 });
          };
        }}
        nodes={nodes.map((node) => ({
          id: node.id,
          position: node.position,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          selected: node.id === selectedId,
          data: {
            label: (
              <div style={{ textAlign: "left" }}>
                <div
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    color: "#087a5d",
                    marginBottom: 5,
                  }}
                >
                  {node.type.replaceAll("_", " ")}
                </div>
                <strong>{node.title}</strong>
                <div style={{ fontSize: 11, marginTop: 8, color: "#62748a" }}>
                  {node.ownerId} · BD+{node.dueOffset}
                </div>
              </div>
            ),
          },
          style: {
            width: 190,
            borderRadius: 7,
            borderColor: node.id === selectedId ? "#087a5d" : "#c9d6df",
            padding: 14,
            background: node.type === "document_gate" ? "#eef8f4" : "#fff",
          },
        }))}
        edges={edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: `${edge.hard ? "Hard" : "Advisory"}${edge.lag ? ` · ${edge.lag} BD` : ""}`,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: {
            stroke: edge.hard ? "#087a5d" : "#8a98aa",
            strokeDasharray: edge.hard ? undefined : "5 4",
          },
        }))}
        nodesDraggable={!readonly}
        nodesConnectable={!readonly}
        edgesReconnectable={!readonly}
        deleteKeyCode={readonly ? null : ["Backspace", "Delete"]}
        onNodeClick={(_, node) => onSelect?.(node.id)}
        onNodesChange={(changes) => {
          if (readonly) return;
          let result = nodes;
          for (const change of changes) {
            if (change.type === "position" && change.position)
              result = result.map((n) =>
                n.id === change.id ? { ...n, position: change.position! } : n,
              );
            if (change.type === "remove") {
              result = result.filter((n) => n.id !== change.id);
              onEdges?.(
                edges.filter(
                  (e) => e.source !== change.id && e.target !== change.id,
                ),
              );
            }
          }
          onNodes?.(result);
        }}
        onEdgesChange={(changes) => {
          if (readonly) return;
          onEdges?.(
            edges.filter(
              (e) => !changes.some((c) => c.type === "remove" && c.id === e.id),
            ),
          );
        }}
        onConnect={(connection) => {
          if (
            !connection.source ||
            !connection.target ||
            connection.source === connection.target ||
            edges.some(
              (e) =>
                e.source === connection.source &&
                e.target === connection.target,
            )
          )
            return;
          onEdges?.([
            ...edges,
            {
              id: crypto.randomUUID(),
              source: connection.source,
              target: connection.target,
              hard: true,
              lag: 0,
            },
          ]);
        }}
        fitView
        minZoom={0.2}
        maxZoom={2}
        aria-label="Workflow dependency diagram"
      >
        <Background gap={20} color="#d6e1e7" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
