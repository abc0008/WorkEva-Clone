"use client";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const user =
    typeof window !== "undefined" ? localStorage.getItem("workeva-user") : null;
  if (user) headers.set("x-workeva-user", user);
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: `Request failed (${response.status})` }));
    throw new Error(error.error || "Request failed");
  }
  return response.json() as Promise<T>;
}
