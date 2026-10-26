// Runs saves one after another, so two quick edits can't overwrite each other on the server.
export function serial() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = last.then(task, task);
    last = run.catch(() => undefined);
    return run;
  };
}
