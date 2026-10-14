# Plan de implementación

## Fase 1 — Fundación técnica (actual)

Monorepo pnpm, aplicaciones React/Vite y Express, paquete compartido, TypeScript estricto, lint y formato, endpoint de salud probado, PostgreSQL local con Compose, esquema Prisma vacío y documentación. No incorpora comportamiento de negocio.

## Fase 2 — Dominio y persistencia

Definir con el negocio el alcance y los flujos prioritarios. Diseñar los primeros modelos de dominio, relaciones, restricciones e índices; añadir migraciones Prisma y acceso a datos con PostgreSQL. Acordar convenciones de API, errores y validación, e incorporar pruebas de integración de persistencia.

## Fase 3 — Experiencia principal

Construir los flujos acordados para gestionar la agenda y las citas, con pantallas accesibles, estados vacíos y validación de formularios. Introducir componentes shadcn/ui cuando aporten valor y mantener contratos web/API tipados.

## Fase 4 — Identidad y control de acceso

Implementar autenticación, sesiones, autorización y auditoría según el modelo de despliegue y las necesidades de seguridad acordadas. Añadir pruebas de permisos y revisión de manejo de secretos.

## Fase 5 — Endurecimiento y entrega

Completar pruebas unitarias, integración y extremo a extremo; observabilidad, rendimiento, copias de seguridad, CI/CD, documentación operativa y preparación del despliegue. Validar los requisitos de privacidad y recuperación antes de producción.

## Próximo paso concreto

Instalar pnpm 10.12.1 mediante `npm.cmd exec --yes --package=pnpm@10.12.1 -- pnpm` (o mediante Corepack si el equipo lo habilita), levantar PostgreSQL cuando Docker Desktop esté instalado, y volver a ejecutar `prisma validate` con sus motores disponibles. Para iniciar Fase 2, documentar decisiones sobre operación del negocio y reglas de agenda antes de diseñar los modelos.
