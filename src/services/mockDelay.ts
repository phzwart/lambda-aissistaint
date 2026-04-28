export const mockDelay = (milliseconds = 450) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
