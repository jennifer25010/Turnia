# Arquitectura de Turnia

Turnia usa un monorepo pnpm con aplicaciones desplegables separadas y un paquete para contratos compartidos. El frontend y la API se ejecutan como procesos independientes durante el desarrollo.

## Directorios

- `apps/web`: interfaz React con Vite y TypeScript. Tailwind CSS v4 ya está integrado; `components.json` y los alias previstos dejan preparada la incorporación gradual de shadcn/ui. Vite carga las variables desde la raíz, escucha en loopback y reenvía `/api` a Express.
- `apps/api`: servidor Express en TypeScript. `src/app.ts` define la aplicación para poder probarla sin abrir un puerto; `src/server.ts` carga `.env` de la raíz e inicia el servidor. Incluye health check, respuestas JSON de error y 404.
- `packages/shared`: tipos y utilidades sin dependencia de la interfaz ni del servidor, consumibles por ambas aplicaciones.
- `prisma`: esquema inicial PostgreSQL sin modelos de negocio y configuración del CLI.
- `docs`: documentación técnica y plan por fases.

## Datos y configuración

Docker Compose inicia PostgreSQL 17 enlazado solo a `127.0.0.1`, en el puerto configurado por `POSTGRES_PORT`, y conserva datos en un volumen nombrado. `.env.example` documenta la URL de Prisma, puertos y credenciales de desarrollo; los archivos `.env` quedan fuera de Git. Los valores de ejemplo no son secretos ni adecuados para despliegue.

Prisma 6 se configura con `prisma/schema.prisma`. Los scripts `prisma:validate` y `prisma:generate` validan el esquema y generan el cliente. pnpm 10.12.1 permite scripts de instalación solo para Prisma, sus motores y el cliente. Esta fase no crea migraciones ni modelos. La API tampoco se conecta todavía a la base de datos.

## Calidad y comandos

TypeScript estricto se comparte desde `tsconfig.base.json`. ESLint usa configuración plana y typescript-eslint; Prettier da formato. Vitest y Supertest prueban la API sin requerir PostgreSQL. Tailwind funciona mediante el plugin de Vite.

Comandos raíz: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm prisma:validate` y `pnpm prisma:generate`. Los resultados de la revisión correctiva se registran en `docs/revision-fase-1.md`.
