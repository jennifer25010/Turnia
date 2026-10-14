<<<<<<< HEAD
# Turnia

Fundación técnica de Turnia: monorepo con React, Vite y TypeScript en el frontend; Express y TypeScript en la API; PostgreSQL, Prisma, Tailwind CSS y Vitest.

## Requisitos

- Node.js 22 LTS; versión de referencia `22.23.3` en `.nvmrc`. Prisma 6 requiere Node `22.12.0` o superior en la línea 22. No es necesario reemplazar una instalación global: usa un gestor de versiones si está disponible.
- pnpm 10.12.1 (el repositorio declara esta versión en `package.json`).
- Docker Desktop con Docker Compose para PostgreSQL.

## Instalación y ejecución

Desde la raíz del repositorio, en PowerShell:

```powershell
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d postgres
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm dev
```

El archivo `.env.example` solo contiene valores locales de muestra. `.env` está excluido de Git. Cambia la contraseña de muestra para tu entorno local y conserva el mismo valor en `DATABASE_URL` y `POSTGRES_PASSWORD`. El Compose publica PostgreSQL únicamente en `127.0.0.1`.

La aplicación web se sirve en `http://localhost:5173` y la API en `http://localhost:3000`. La comprobación de salud está en `http://localhost:3000/api/v1/health`.

Para detener los procesos, usa `Ctrl+C` y luego `docker compose down`. Los datos locales quedan en el volumen `turnia-postgres-data`; `docker compose down -v` también lo elimina.

## Verificación

```powershell
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm test
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm typecheck
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm lint
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm format:check
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm build
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm prisma:validate
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm prisma:generate
docker compose config
```

En pnpm 10.12.1, el workspace permite scripts de instalación solo para `prisma`, `@prisma/engines` y `@prisma/client`, mediante `onlyBuiltDependencies` en `pnpm-workspace.yaml`. La lista se mantiene acotada y puede revisarse con `pnpm approve-builds`; no uses una aprobación global.

Resultados de la revisión correctiva, incluidas pruebas, builds, Prisma y limitaciones del entorno: [docs/revision-fase-1.md](docs/revision-fase-1.md). El Node detectado era `v26.5.1`, fuera del rango del proyecto; selecciona `22.23.3` con tu gestor local de versiones antes de continuar. No se actualizó Node globalmente.

## Prisma

El esquema PostgreSQL inicial está en `prisma/schema.prisma` y no contiene modelos de negocio. Tras crear `.env`, ejecuta `pnpm prisma:validate` para validar el esquema y `pnpm prisma:generate` para generar Prisma Client. Validar o generar no requiere que PostgreSQL esté levantado; conectar la aplicación sí.

## Verificar en Windows

Desde PowerShell en la raíz del repositorio:

```powershell
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm install --frozen-lockfile
docker version
docker compose version
docker compose config
docker compose up -d postgres
docker compose ps
docker compose exec postgres sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm prisma:validate
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm prisma:generate
```

Si `docker version` no conecta con el daemon, inicia Docker Desktop. Si `docker compose config` informa variables faltantes, confirma que `.env` existe en la raíz. Prisma carga `DATABASE_URL` desde ese archivo al ejecutarse desde el workspace.

## Documentación

- [Arquitectura](docs/architecture.md)
- [Plan de implementación](docs/implementation-plan.md)
=======
# turnia
>>>>>>> ceb93a00758fde93f2d81949dc98baa013b7559b
