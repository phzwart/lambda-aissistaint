export const createErrorHandler = ({ deps }) => {
  const { log } = deps;
  return (error, _request, response, _next) => {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    log('API error', {
      status,
      message: error instanceof Error ? error.message : 'Unexpected API error.',
    });
    response.status(status).json({
      error: status >= 500 ? 'Unexpected API error.' : error instanceof Error ? error.message : 'Request failed.',
    });
  };
};

export const forbidden = (message = 'You do not have access to this project.') => {
  const error = new Error(message);
  error.status = 403;
  return error;
};
