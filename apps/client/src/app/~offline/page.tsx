export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-3 px-6 py-16">
      <h1 className="text-2xl font-semibold">You are offline</h1>
      <p className="text-muted">
        This page is not available without a connection. Open a casualty card you
        have already visited, or reconnect and try again.
      </p>
    </main>
  );
}
