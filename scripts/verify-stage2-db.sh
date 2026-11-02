#!/bin/sh
# Verifica la Etapa 2A contra PostgreSQL REAL usando una base de datos TEMPORAL
# (turnia_verify_*). No toca tu base de desarrollo: crea la base temporal,
# aplica ahí las migraciones, ejecuta las comprobaciones y la elimina al final.
#
# Uso (desde la raíz del proyecto, en Ubuntu/WSL con Docker Desktop):
#   sh scripts/verify-stage2-db.sh                      # usa el contenedor "postgres"
#   PSQL_CMD='psql -h 127.0.0.1 -p 5433 -U usuario' PGPASSWORD=... \
#       sh scripts/verify-stage2-db.sh                  # usa un psql directo
#
# Código de salida 0 = todo correcto; distinto de 0 = alguna comprobación falló.
set -u

DB="${VERIFY_DB:-turnia_verify_stage2}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-prisma/migrations}"

case "$DB" in
  turnia_verify*) ;;
  *) echo "Por seguridad, VERIFY_DB debe empezar por 'turnia_verify'." >&2; exit 2 ;;
esac

psql_run() {
  if [ -n "${PSQL_CMD:-}" ]; then
    # shellcheck disable=SC2086
    $PSQL_CMD "$@"
  else
    docker compose exec -T postgres sh -c 'exec psql -U "$POSTGRES_USER" "$@"' sh "$@"
  fi
}

admin() { psql_run -d postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
sql()   { psql_run -d "$DB" -v ON_ERROR_STOP=1 -q -At "$@"; }

pass=0
fail=0
ok()  { pass=$((pass + 1)); echo "  [OK]    $1"; }
bad() { fail=$((fail + 1)); echo "  [FALLO] $1"; }

expect_ok() {
  desc=$1; shift
  if out=$(sql -c "$1" 2>&1); then ok "$desc"; else bad "$desc -> $out"; fi
}
expect_fail() {
  desc=$1; pat=$2; shift 2
  if out=$(sql -c "$1" 2>&1); then
    bad "$desc (debía fallar y se ejecutó)"
  else
    case "$out" in
      *"$pat"*) ok "$desc" ;;
      *) bad "$desc (falló por otra causa: $out)" ;;
    esac
  fi
}
expect_eq() {
  desc=$1; want=$2; shift 2
  got=$(sql -c "$1" 2>&1 | tr -d ' \r\n')
  if [ "$got" = "$want" ]; then ok "$desc"; else bad "$desc (esperado '$want', obtenido '$got')"; fi
}

cleanup() { admin -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

B=11111111-1111-4111-8111-111111111111   # negocio
B2=12121212-1212-4212-8212-121212121212  # otro negocio
SV=22222222-2222-4222-8222-222222222222  # servicio
ANA=33333333-3333-4333-8333-333333333333
LUIS=44444444-4444-4444-8444-444444444444
CU=55555555-5555-4555-8555-555555555555
U1=66666666-6666-4666-8666-666666666666  # usuario

bk() { # id staff inicio fin estado
  echo "INSERT INTO \"Booking\"(id,\"businessId\",\"customerId\",\"serviceId\",\"staffId\",source,status,\"customerNameSnapshot\",\"serviceNameSnapshot\",\"durationMinutesSnapshot\",\"priceSnapshot\",\"startsAt\",\"endsAt\",\"updatedAt\") VALUES ('$1','$B','$CU','$SV','$2','PANEL','$5','C','Corte',30,25000,'$3','$4',now());"
}
ev() { # id booking negocio actor
  echo "INSERT INTO \"BookingEvent\"(id,\"businessId\",\"bookingId\",type,\"actorUserId\") VALUES ('$1','$3','$2','CANCELLED','$4');"
}

echo "== Preparación: base temporal $DB"
admin -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" || { echo "No se pudo crear la base temporal"; exit 2; }

echo "== 1) Actualización con datos existentes (simula tu base antes de la Etapa 2A)"
STAGE2=""
for dir in $(ls "$MIGRATIONS_DIR" | grep -E '^[0-9]' | sort); do
  case "$dir" in
    *booking_management) STAGE2=$dir ;;
    *) sql -1 < "$MIGRATIONS_DIR/$dir/migration.sql" >/dev/null 2>&1 \
         && ok "migración previa aplicada: $dir" || bad "migración previa falló: $dir" ;;
  esac
done
[ -n "$STAGE2" ] || { echo "No se encontró la migración *_booking_management"; exit 2; }

sql <<SQL >/dev/null
INSERT INTO "Business"(id,name,slug,"updatedAt") VALUES ('$B','Demo','demo',now()),('$B2','Otro','otro',now());
INSERT INTO "Service"(id,"businessId",name,"durationMinutes",price,"updatedAt") VALUES ('$SV','$B','Corte',30,25000,now());
INSERT INTO "Staff"(id,"businessId","displayName","updatedAt") VALUES ('$ANA','$B','Ana',now()),('$LUIS','$B','Luis',now());
INSERT INTO "Customer"(id,"businessId",name,"updatedAt") VALUES ('$CU','$B','Cliente',now());
INSERT INTO "User"(id,email,"emailNormalized","passwordHash","fullName","updatedAt") VALUES ('$U1','a@b.co','a@b.co','x','Ana',now());
$(bk aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1 $ANA 2026-10-26T15:00:00Z 2026-10-26T15:30:00Z CONFIRMED)
$(bk aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2 $ANA 2026-10-26T16:00:00Z 2026-10-26T16:30:00Z CANCELLED)
SQL
expect_eq "hay 2 reservas heredadas antes de migrar" "2" 'SELECT count(*) FROM "Booking"'

if sql -1 < "$MIGRATIONS_DIR/$STAGE2/migration.sql" >/dev/null 2>&1; then ok "migración $STAGE2 aplicada sobre datos existentes"; else bad "migración $STAGE2 falló"; fi
expect_eq "las 2 reservas heredadas se conservan" "2" 'SELECT count(*) FROM "Booking"'
expect_eq "reservas heredadas quedan con version=1" "2" 'SELECT count(*) FROM "Booking" WHERE version = 1'
expect_eq "la migración NO inventa eventos históricos" "0" 'SELECT count(*) FROM "BookingEvent"'
expect_eq "políticas por defecto = sin restricción" "0|0" 'SELECT "cancellationNoticeMinutes" || chr(124) || "rescheduleNoticeMinutes" FROM "Business" WHERE id = '"'$B'"

echo "== 2) Restricciones, auditoría inmutable y aislamiento"
H1=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1
expect_ok "cancelar + registrar evento en UNA transacción" "UPDATE \"Booking\" SET status='CANCELLED', version=version+1 WHERE id='$H1' AND version=1; $(ev eeeeeeee-0000-4000-8000-000000000001 $H1 $B $U1)"
expect_eq "la reserva quedó CANCELLED con version=2" "CANCELLED|2" "SELECT status || chr(124) || version FROM \"Booking\" WHERE id='$H1'"
expect_fail "el historial no se puede modificar" "solo inserción" "UPDATE \"BookingEvent\" SET reason='x' WHERE id='eeeeeeee-0000-4000-8000-000000000001'"
expect_fail "el historial no se puede borrar" "solo inserción" "DELETE FROM \"BookingEvent\" WHERE id='eeeeeeee-0000-4000-8000-000000000001'"
expect_fail "no se puede borrar una reserva con historial" "foreign key" "DELETE FROM \"Booking\" WHERE id='$H1'"
expect_fail "un evento no puede apuntar a una reserva de otro negocio" "foreign key" "$(ev eeeeeeee-0000-4000-8000-000000000002 $H1 $B2 $U1)"
expect_fail "version debe ser >= 1" "booking_version_positive" "UPDATE \"Booking\" SET version=0 WHERE id='$H1'"
expect_fail "aviso mínimo no puede ser negativo" "business_notice_minutes_valid" "UPDATE \"Business\" SET \"cancellationNoticeMinutes\"=-1 WHERE id='$B'"
expect_fail "aviso mínimo máximo 43200 minutos" "business_notice_minutes_valid" "UPDATE \"Business\" SET \"rescheduleNoticeMinutes\"=43201 WHERE id='$B'"
expect_ok "aviso mínimo en los límites 0 y 43200" "UPDATE \"Business\" SET \"cancellationNoticeMinutes\"=0, \"rescheduleNoticeMinutes\"=43200 WHERE id='$B'; UPDATE \"Business\" SET \"rescheduleNoticeMinutes\"=0 WHERE id='$B'"

M1=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1
M2=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2
M3=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3
sql <<SQL >/dev/null
$(bk $M1 $ANA 2026-10-27T15:00:00Z 2026-10-27T15:30:00Z CONFIRMED)
$(bk $M2 $ANA 2026-10-27T16:00:00Z 2026-10-27T16:30:00Z CONFIRMED)
$(bk $M3 $LUIS 2026-10-27T17:00:00Z 2026-10-27T17:30:00Z CONFIRMED)
SQL
expect_fail "modificar: mover una reserva encima de otra del mismo empleado" "booking_staff_no_overlapping_active" "UPDATE \"Booking\" SET \"startsAt\"='2026-10-27T15:15:00Z',\"endsAt\"='2026-10-27T15:45:00Z' WHERE id='$M2'"
expect_ok "modificar: moverla a un hueco libre" "UPDATE \"Booking\" SET \"startsAt\"='2026-10-27T18:00:00Z',\"endsAt\"='2026-10-27T18:30:00Z' WHERE id='$M2'"
expect_ok "modificar: desplazarse unos minutos sin chocar consigo misma" "UPDATE \"Booking\" SET \"startsAt\"='2026-10-27T18:10:00Z',\"endsAt\"='2026-10-27T18:40:00Z' WHERE id='$M2'"
expect_ok "modificar: cita adyacente permitida (fin = inicio de otra)" "UPDATE \"Booking\" SET \"startsAt\"='2026-10-27T15:30:00Z',\"endsAt\"='2026-10-27T16:00:00Z' WHERE id='$M2'"
expect_fail "modificar: pasar la cita a un empleado ocupado" "booking_staff_no_overlapping_active" "UPDATE \"Booking\" SET \"staffId\"='$LUIS',\"startsAt\"='2026-10-27T17:00:00Z',\"endsAt\"='2026-10-27T17:30:00Z' WHERE id='$M2'"
expect_ok "una cancelada libera el horario para otra reserva" "$(bk bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb10 $ANA 2026-10-26T15:00:00Z 2026-10-26T15:30:00Z CONFIRMED)"
expect_fail "reactivar una cancelada con el horario ya tomado" "booking_staff_no_overlapping_active" "UPDATE \"Booking\" SET status='CONFIRMED' WHERE id='$H1'"

echo "== 3) Atomicidad: si falla el evento, el cambio se revierte"
expect_fail "evento con actor inexistente aborta toda la transacción" "foreign key" "UPDATE \"Booking\" SET status='CANCELLED', version=version+1 WHERE id='$M3'; $(ev eeeeeeee-0000-4000-8000-000000000003 $M3 $B 99999999-9999-4999-8999-999999999999)"
expect_eq "la reserva NO quedó cancelada ni con version distinta" "CONFIRMED|1" "SELECT status || chr(124) || version FROM \"Booking\" WHERE id='$M3'"
expect_eq "no quedó ningún evento huérfano" "0" "SELECT count(*) FROM \"BookingEvent\" WHERE \"bookingId\"='$M3'"

echo "== 4) Concurrencia real (varias sesiones simultáneas)"
tmp=$(mktemp -d)
C1=cccccccc-cccc-4ccc-8ccc-ccccccccccc1
sql -c "$(bk $C1 $ANA 2026-10-28T15:00:00Z 2026-10-28T15:30:00Z CONFIRMED)" >/dev/null

# 4a) Dos cancelaciones con la misma versión: solo una debe afectar la fila.
upd="WITH u AS (UPDATE \"Booking\" SET status='CANCELLED', version=version+1 WHERE id='$C1' AND version=1 AND status IN ('PENDING','CONFIRMED') RETURNING 1) SELECT count(*) FROM u"
( sql -c "BEGIN; $upd; SELECT pg_sleep(2); COMMIT;" > "$tmp/a.out" 2>&1 ) &
sleep 0.7
( sql -c "BEGIN; $upd; COMMIT;" > "$tmp/b.out" 2>&1 ) &
wait
ra=$(grep -E '^[0-9]+$' "$tmp/a.out" | head -1); rb=$(grep -E '^[0-9]+$' "$tmp/b.out" | head -1)
if [ "$ra" = "1" ] && [ "$rb" = "0" ]; then ok "doble cancelación simultánea: una afecta 1 fila, la otra 0 (la segunda esperó y vio el cambio)"; else bad "doble cancelación: A=$ra B=$rb (esperado 1 y 0)"; fi
expect_eq "la reserva se canceló una sola vez (version=2)" "CANCELLED|2" "SELECT status || chr(124) || version FROM \"Booking\" WHERE id='$C1'"

# 4b) Cancelar y modificar a la vez (misma versión esperada): gana una sola.
C2=cccccccc-cccc-4ccc-8ccc-ccccccccccc2
sql -c "$(bk $C2 $ANA 2026-10-28T17:00:00Z 2026-10-28T17:30:00Z CONFIRMED)" >/dev/null
canc="WITH u AS (UPDATE \"Booking\" SET status='CANCELLED', version=version+1 WHERE id='$C2' AND version=1 AND status IN ('PENDING','CONFIRMED') RETURNING 1) SELECT count(*) FROM u"
modi="WITH u AS (UPDATE \"Booking\" SET \"startsAt\"='2026-10-28T19:00:00Z', \"endsAt\"='2026-10-28T19:30:00Z', version=version+1 WHERE id='$C2' AND version=1 AND status IN ('PENDING','CONFIRMED') RETURNING 1) SELECT count(*) FROM u"
( sql -c "BEGIN; $canc; SELECT pg_sleep(2); COMMIT;" > "$tmp/c.out" 2>&1 ) &
sleep 0.7
( sql -c "BEGIN; $modi; COMMIT;" > "$tmp/d.out" 2>&1 ) &
wait
rc=$(grep -E '^[0-9]+$' "$tmp/c.out" | head -1); rd=$(grep -E '^[0-9]+$' "$tmp/d.out" | head -1)
if [ "$rc" = "1" ] && [ "$rd" = "0" ]; then ok "cancelar vs modificar simultáneos: solo uno aplica, el otro recibe 0 filas"; else bad "cancelar vs modificar: C=$rc D=$rd (esperado 1 y 0)"; fi

# 4c) 20 modificaciones simultáneas de reservas distintas al MISMO horario.
S=2026-10-29T15:00:00Z; E=2026-10-29T15:30:00Z
i=1
while [ $i -le 20 ]; do
  n=$(printf '%02d' $i)
  sql -c "$(bk dddddddd-dddd-4ddd-8ddd-0000000000$n $ANA 2026-10-30T${n}:00:00Z 2026-10-30T${n}:30:00Z CONFIRMED)" >/dev/null 2>&1 || true
  i=$((i + 1))
done
# (horas 21..24 no existen: solo se insertan 01..20 con hora válida <= 20)
i=1
while [ $i -le 20 ]; do
  n=$(printf '%02d' $i)
  ( sql -c "UPDATE \"Booking\" SET \"startsAt\"='$S', \"endsAt\"='$E' WHERE id='dddddddd-dddd-4ddd-8ddd-0000000000$n'" > "$tmp/m$n.out" 2>&1 && echo OK > "$tmp/m$n.res" || echo ERR > "$tmp/m$n.res" ) &
  i=$((i + 1))
done
wait
okc=$(cat "$tmp"/m*.res | grep -c '^OK$'); errc=$(cat "$tmp"/m*.res | grep -c '^ERR$')
if [ "$okc" = "1" ] && [ "$errc" = "19" ]; then ok "20 modificaciones simultáneas al mismo horario: 1 aplicó y 19 fueron rechazadas"; else bad "20 modificaciones simultáneas: OK=$okc ERR=$errc (esperado 1 y 19)"; fi
expect_eq "solo una reserva activa ocupa ese horario" "1" "SELECT count(*) FROM \"Booking\" WHERE \"staffId\"='$ANA' AND \"startsAt\"='$S' AND status IN ('PENDING','CONFIRMED')"

# 4d) Intercambio simultáneo de horarios entre dos citas: sin deadlock.
X1=ffffffff-ffff-4fff-8fff-fffffffffff1; X2=ffffffff-ffff-4fff-8fff-fffffffffff2
sql -c "$(bk $X1 $LUIS 2026-11-02T15:00:00Z 2026-11-02T15:30:00Z CONFIRMED) $(bk $X2 $LUIS 2026-11-02T16:00:00Z 2026-11-02T16:30:00Z CONFIRMED)" >/dev/null
( sql -c "BEGIN; UPDATE \"Booking\" SET \"startsAt\"='2026-11-02T16:00:00Z',\"endsAt\"='2026-11-02T16:30:00Z' WHERE id='$X1'; SELECT pg_sleep(1); COMMIT;" > "$tmp/s1.out" 2>&1; echo "$?" > "$tmp/s1.rc" ) &
( sql -c "BEGIN; UPDATE \"Booking\" SET \"startsAt\"='2026-11-02T15:00:00Z',\"endsAt\"='2026-11-02T15:30:00Z' WHERE id='$X2'; SELECT pg_sleep(1); COMMIT;" > "$tmp/s2.out" 2>&1; echo "$?" > "$tmp/s2.rc" ) &
wait
if grep -qi 'deadlock' "$tmp/s1.out" "$tmp/s2.out"; then bad "intercambio simultáneo provocó deadlock"; else ok "intercambio simultáneo A<->B: sin deadlock"; fi
both_ok=0; [ "$(cat "$tmp/s1.rc")" = "0" ] && [ "$(cat "$tmp/s2.rc")" = "0" ] && both_ok=1
if [ "$both_ok" = "0" ]; then ok "el intercambio simultáneo no dejó dos citas solapadas"; else bad "ambas actualizaciones del intercambio se aplicaron"; fi
expect_eq "no existen solapes activos del mismo empleado en toda la base" "0" 'SELECT count(*) FROM "Booking" a JOIN "Booking" b ON a."staffId"=b."staffId" AND a.id<b.id AND a.status IN ('"'PENDING','CONFIRMED'"') AND b.status IN ('"'PENDING','CONFIRMED'"') AND tstzrange(a."startsAt",a."endsAt") && tstzrange(b."startsAt",b."endsAt")'

rm -rf "$tmp"
echo
echo "== Resultado: $pass correctas, $fail con fallo"
[ "$fail" -eq 0 ] && echo "TODAS LAS COMPROBACIONES PASARON (base temporal eliminada)" || echo "HAY COMPROBACIONES FALLIDAS"
[ "$fail" -eq 0 ]
