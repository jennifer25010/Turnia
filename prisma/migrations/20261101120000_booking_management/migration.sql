-- Etapa 2A: gestión de reservas (cancelar, modificar, historial y políticas).
--
-- Migración ADITIVA: solo agrega tipos, columnas con valor por defecto, una
-- tabla nueva, índices y claves foráneas. No borra ni reescribe datos
-- existentes y NO crea eventos históricos para reservas anteriores.
--
-- Requiere que la migración 20261031150000_schedule_integrity_checks (Etapa 1)
-- ya esté aplicada; Prisma las ejecuta en orden por nombre.

-- CreateEnum
CREATE TYPE "BookingEventType" AS ENUM ('CREATED', 'MODIFIED', 'CANCELLED', 'STATUS_CHANGED');

-- CreateEnum
CREATE TYPE "BookingActorType" AS ENUM ('USER', 'CUSTOMER', 'SYSTEM');

-- AlterTable: política de avisos mínimos por negocio (0 = sin restricción)
ALTER TABLE "Business"
ADD COLUMN "cancellationNoticeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "rescheduleNoticeMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: versión para concurrencia optimista y datos de cancelación
ALTER TABLE "Booking"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "cancelReason" TEXT,
ADD COLUMN "cancelledByUserId" UUID;

-- CreateIndex: permite la clave foránea compuesta (bookingId, businessId)
CREATE UNIQUE INDEX "Booking_id_businessId_key" ON "Booking"("id", "businessId");

-- CreateTable
CREATE TABLE "BookingEvent" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "type" "BookingEventType" NOT NULL,
    "actorType" "BookingActorType" NOT NULL DEFAULT 'USER',
    "actorUserId" UUID,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus",
    "reason" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingEvent_bookingId_createdAt_idx" ON "BookingEvent"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingEvent_businessId_createdAt_idx" ON "BookingEvent"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingEvent_actorUserId_idx" ON "BookingEvent"("actorUserId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_bookingId_businessId_fkey" FOREIGN KEY ("bookingId", "businessId") REFERENCES "Booking"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas de integridad que Prisma no expresa (no son detectadas como "drift").
ALTER TABLE "Business"
ADD CONSTRAINT "business_notice_minutes_valid"
CHECK (
    "cancellationNoticeMinutes" BETWEEN 0 AND 43200
    AND "rescheduleNoticeMinutes" BETWEEN 0 AND 43200
);

ALTER TABLE "Booking"
ADD CONSTRAINT "booking_version_positive"
CHECK ("version" >= 1);

-- Historial inmutable: los eventos solo se insertan. Evita que un error de la
-- aplicación (o una edición manual descuidada) altere o borre la auditoría.
-- Para una corrección excepcional hay que desactivar el trigger de forma
-- explícita y consciente.
CREATE FUNCTION "booking_event_immutable"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'BookingEvent es de solo inserción (operación % no permitida)', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "booking_event_no_update_delete"
BEFORE UPDATE OR DELETE ON "BookingEvent"
FOR EACH ROW EXECUTE FUNCTION "booking_event_immutable"();
