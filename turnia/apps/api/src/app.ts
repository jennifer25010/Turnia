import express from "express";
import type { ErrorRequestHandler } from "express";

export const app = express();

app.disable("x-powered-by");
app.use(express.json());

app.get("/api/v1/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

app.use((_request, response) => {
  response.status(404).json({
    error: { code: "NOT_FOUND", message: "Ruta no encontrada" },
  });
});

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  void next;
  const candidate =
    typeof error === "object" && error !== null
      ? (error as { status?: unknown; statusCode?: unknown; message?: unknown })
      : {};
  const suppliedStatus = candidate.status ?? candidate.statusCode;
  const status =
    typeof suppliedStatus === "number" &&
    suppliedStatus >= 400 &&
    suppliedStatus <= 599
      ? suppliedStatus
      : 500;
  const message =
    status >= 500 && process.env.NODE_ENV === "production"
      ? "Error interno del servidor"
      : typeof candidate.message === "string"
        ? candidate.message
        : "Error interno del servidor";

  response.status(status).json({
    error: {
      code: status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST",
      message,
    },
  });
};

app.use(errorHandler);
