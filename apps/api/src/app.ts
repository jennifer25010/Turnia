
import express from "express";
import type { ErrorRequestHandler } from "express";
import { prisma } from "./lib/prisma.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json());

// Health check de la API
app.get("/api/v1/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
  });
});

// Health check de la conexión a PostgreSQL
app.get("/api/v1/health/db", async (_request, response) => {
  await prisma.$queryRaw`SELECT 1`;

  response.status(200).json({
    status: "ok",
    database: "connected",
  });
});

// Middleware centralizado de errores
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  const candidate =
    typeof error === "object" && error !== null
      ? (error as {
          status?: unknown;
          statusCode?: unknown;
          message?: unknown;
        })
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

// Ruta 404 para endpoints inexistentes
app.use((_request, response) => {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Ruta no encontrada",
    },
  });
});

// Registrar una sola vez el middleware de errores
app.use(errorHandler);
