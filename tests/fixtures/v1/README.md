# Fixtures de almacenamiento v1

`jobs-v1.ts` es una copia exacta de `src/jobs.ts` del baseline `efc690ffdf15c3157eb7167a02dac12f6668843a`.

SHA-256: `e781e69fedff2a4d94af141a7986156cc03079179dcd09519bbb46030f09e3e2`.

No actualizar esta definición cuando cambie producción. El generador `tests/helpers/legacy.mjs` crea SQLite temporales con datos sintéticos usando ese token y APIs públicas de Pi Durable 1.0.1. Nunca se incluyen bases reales del usuario.

Escenarios: cola en orden distinto del ID; provisioning con conversación real; running con submission real detenida mediante barrera del proveedor faux; terminales completed/failed/interrupted (este último sintético); resultado de 1 MiB. El reloj de los registros es fijo y las expectativas se conservan antes de persistir. La fixture running no requiere sleeps para alcanzar la ventana de cierre.
