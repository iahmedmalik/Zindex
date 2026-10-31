"use client";

import { ErrorPanel } from "@/components/ErrorPanel";

// Catches anything that breaks while a page draws, so people see a calm screen with "Try again" instead of a crash.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} />;
}
