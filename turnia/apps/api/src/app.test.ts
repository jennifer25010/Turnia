import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app, errorHandler } from "./app.js";

describe("GET /api/v1/health", () => {
  it("responde que la API está disponible", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

describe("respuestas de error", () => {
  it("responde JSON consistente para rutas inexistentes", async () => {
    const response = await request(app).get("/api/v1/no-existe");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: "Ruta no encontrada" },
    });
  });

  it("responde JSON sin trazas para JSON malformado", async () => {
    const response = await request(app)
      .post("/api/v1/health")
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });

  it("oculta detalles de errores internos en producción", async () => {
    const productionApp = express();
    productionApp.get("/failure", (_request, _response, next) => {
      next(new Error("detalle interno confidencial"));
    });
    productionApp.use(errorHandler);

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const response = await request(productionApp).get("/failure");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Error interno del servidor",
        },
      });
      expect(JSON.stringify(response.body)).not.toContain("confidencial");
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });
});
