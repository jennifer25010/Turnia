# Revisión correctiva de la Fase 1

## Hallazgos y correcciones

- Se añadieron `.gitattributes` para normalizar archivos de texto a LF y `.nvmrc` con Node `22.23.3`.
- `engines.node` queda restringido a `^22.12.0`. Prisma ORM 6 declara compatibilidad con Node `^22.12.0` ([requisitos de Prisma 6](https://www.prisma.io/docs/orm/v6/reference/system-requirements)); se fijó `.nvmrc` en `22.23.3`, versión LTS de la línea 22 ([archivo de releases de Node](https://nodejs.org/en/download/archive/v22)). La máquina tenía Node 26.5.1, pero no se cambió ninguna instalación global.
- Se configuró `onlyBuiltDependencies` de pnpm 10.12.1 para permitir únicamente `prisma`, `@prisma/engines` y `@prisma/client`. Es el mecanismo que el comando `pnpm approve-builds` de pnpm 10.1+ registra en `pnpm-workspace.yaml` ([CLI](https://pnpm.io/10.x/cli/approve-builds), [configuración 10.x](https://pnpm.io/10.x/settings#onlybuiltdependencies)); no se aprobó el resto de scripts ni se activó `dangerouslyAllowAllBuilds`.
- La API carga el `.env` de la raíz explícitamente. Vite usa el directorio raíz del workspace para cargar variables en su configuración, mantiene el prefijo de exposición del cliente de Vite y reenvía `/api` al puerto de la API.
- Vite escucha en `127.0.0.1` por defecto. Se retiró el `--host 0.0.0.0` del script de desarrollo.
- La API responde JSON con un formato común para rutas inexistentes y errores. En producción, los errores 5xx devuelven un mensaje genérico y no incluyen trazas.
- `tsconfig.build.json` excluye `*.test.ts` y `*.spec.ts` de la compilación de producción.
- Compose enlaza PostgreSQL solo a localhost. Nombre de base de datos, usuario, contraseña y puerto llegan desde `.env`; `.env.example` contiene valores de muestra y no credenciales reales.
- Se añadieron `prisma:validate` y `prisma:generate`, y `@prisma/client` queda alineado con la versión mayor Prisma 6 ya existente.

## Instalación y lockfile

La instalación se realiza desde PowerShell en la raíz:

```powershell
npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm install
```

Para comprobar que los manifiestos y `pnpm-lock.yaml` están sincronizados:

```powershell
pnpm install --frozen-lockfile
```

Resultados: `pnpm install` terminó en pnpm `10.12.1`, ejecutó el postinstall de `@prisma/client`, y `pnpm install --frozen-lockfile` terminó con `Lockfile is up to date`. No se borraron `node_modules` ni el lockfile.

## Validación en el entorno de trabajo

- Node detectado: `v26.5.1`, fuera de `engines.node`; no se actualizó globalmente. Seleccionar Node `22.23.3` con un gestor de versiones antes de repetir el conjunto final.
- pnpm fijado en `packageManager`: `10.12.1`.
- Pruebas API: **pasan**, 4/4, incluyendo 404, JSON malformado y ocultación de detalles 5xx en producción.
- Compilación de API: **pasa**; se verificó que el build no emite `app.test.js`.
- Compilación del frontend y typecheck de ambos proyectos: **pasan**.
- ESLint y Prettier: **pasan**.
- Prisma `validate` y `generate`: **pasan** con Prisma `6.19.3`. No requieren una conexión activa a PostgreSQL; se pasó `DATABASE_URL` al proceso, sin guardarla en Git.
- API compilada y Vite de desarrollo: **pasan**. La API cargó `API_PORT=3001` y Vite `WEB_PORT=5174` desde un `.env` temporal; el health check directo y a través del proxy devolvió HTTP 200. Vite imprimió `http://127.0.0.1:5174/` como dirección local.
- API `tsx watch`: **falla en este entorno** con `uv_os_get_passwd returned ENOMEM` bajo Node 26.5.1. Se recomienda repetir con Node 22.23.3 antes de atribuirlo a la configuración de la app.
- Docker Compose y conexión a PostgreSQL: **no ejecutados**, ya que Docker no está disponible en PATH.
- `docker compose config` se intentó; falló porque el ejecutable `docker` no existe en este entorno. No cuenta como validación Compose.
- La inspección auxiliar con `Get-NetTCPConnection` fue denegada por permisos; Vite anunció `127.0.0.1` y el health check a través del proxy confirmó el comportamiento.

## Comandos en Windows para verificar Docker y Prisma

Con Docker Desktop iniciado, `.env` creado desde `.env.example` y pnpm 10.12.1 disponible:

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

`prisma:validate` y `prisma:generate` validan/generan localmente; no prueban una conexión de la API a PostgreSQL. Esta fase mantiene el esquema sin modelos de negocio.
