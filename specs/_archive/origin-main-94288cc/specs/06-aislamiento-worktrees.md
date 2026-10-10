# 06 — Aislamiento durable con Git worktrees

## Estado y dependencias

Propuesta. Depende de 01–05; integra gates de 04 y conserva grupos de 05.

## Objetivo

Ejecutar opcionalmente un trabajo en una copia Git aislada y preservar sus cambios como una rama candidata, sin fusionarla ni promoverla automáticamente.

## Garantía y límite

`isolation: "worktree"` es una garantía estricta: si no puede crearse el worktree, el trabajo falla antes de ejecutar al agente. Nunca cae silenciosamente al checkout principal.

Un worktree no es una sandbox. Un agente con `bash` puede acceder a otras rutas con los permisos del proceso. El aislamiento protege principalmente contra colisiones accidentales en el árbol de trabajo.

## Precondiciones

- cwd pertenece a un repositorio Git.
- Existe al menos un commit (`HEAD`).
- Git está disponible.
- La ruta real del repo puede resolverse.
- No existe ya un worktree registrado con el identificador elegido.
- El directorio base de worktrees es privado (`0700`).

Los cambios staged o no confirmados del checkout principal **no** aparecen en el worktree. La tool y la UI deben advertirlo al solicitar aislamiento.

## Contrato de inicio

```json
{
  "isolation": {
    "mode": "worktree",
    "base_ref": "HEAD",
    "preserve": "branch_if_changed"
  }
}
```

V1 solo admite `HEAD` o un commit resuelto y capturado al crear el job. Branch names del caller quedan fuera de alcance para evitar que cambien durante la cola.

`preserve` V1:

- `branch_if_changed` (predeterminado);
- `always_branch`;
- `discard` solo para trabajos de lectura y con confirmación humana si hubo cambios.

## Registro persistente

```ts
worktree?: {
  mode: "worktree";
  repoRoot: string;
  requestedCwd: string;
  baseCommit: string;
  path: string;
  branch: string;
  phase: "planned" | "creating" | "ready" | "preserving" |
    "cleaning" | "cleaned" | "failed";
  createdAt?: number;
  preservedCommit?: string;
  hasChanges?: boolean;
  cleanupError?: string;
};
```

Las rutas persistidas se validan por prefijo real dentro del directorio administrado antes de borrar.

## Nombres

- Directorio: `<state-dir>/worktrees/<safe-session>/<job-id>`.
- Rama: `pi-agents/<short-session>/<job-id>`.

Se normalizan componentes y se comprueba colisión. No se interpolan nombres de agente o tarea en comandos Git.

## Flujo

```text
queued
  └─▶ provisioning
       └─ persistir planned/baseCommit
          └─ persistir creating
             └─ git worktree add --detach <path> <baseCommit>
                └─ crear rama candidata
                   └─ persistir ready
                      └─ configurar conversación con cwd equivalente
                         └─ ejecutar agente y gates
                            └─ preservar cambios
                               └─ eliminar worktree
                                  └─ terminal job
```

El cwd equivalente conserva la ruta relativa desde repoRoot. Si el cwd original está fuera del repo o la ruta relativa no existe en el worktree, falla antes de ejecutar.

## Ejecución de Git

- Usar `execFile`/API con argv, nunca shell concatenado.
- Timeouts explícitos y stdout/stderr acotados.
- No usar `--no-verify` por defecto al crear commits; hooks pueden ejecutar código. La política de hooks debe decidirse explícitamente.
- Recomendación V1: commits automáticos con variables de entorno que deshabiliten firma interactiva y mensaje determinista; si hooks bloquean, estado `preservation_failed` y worktree retenido para diagnóstico.

Antes de implementar se decidirá si los hooks se ejecutan. Cualquiera de las opciones debe documentar seguridad y reproducibilidad.

## Preservación

Después de agente y gates:

1. inspeccionar `git status --porcelain=v2`;
2. si no hay cambios, no crear commit salvo `always_branch`;
3. si hay cambios, añadir únicamente dentro del worktree;
4. crear commit candidato;
5. registrar hash y rama;
6. eliminar worktree;
7. conservar rama como único artefacto.

Si el agente creó commits, la rama candidata apunta a su HEAD y los cambios no confirmados se agregan en un commit final adicional. No se reescribe historia.

El resultado muestra rama, commit base, commit final y comando sugerido de inspección. Nunca ejecuta merge, rebase, push o cherry-pick.

## Gates

Los gates se ejecutan dentro del worktree antes de preservarlo. Si el gate modifica archivos, esos cambios forman parte del candidato y deben identificarse en metadatos. Una configuración futura podrá exigir gates read-only; fuera de V1.

## Recuperación por fase

| Fase persistida | Acción al reabrir |
|---|---|
| `planned` | comprobar base y continuar creación |
| `creating` | consultar `git worktree list --porcelain`; adoptar si coincide o limpiar residuo seguro |
| `ready` | reabrir conversación/submission con el cwd persistido |
| `preserving` | inspeccionar rama, HEAD y estado antes de repetir cualquier commit |
| `cleaning` | repetir `git worktree remove` solo sobre ruta validada |
| `cleaned` | no tocar la rama |
| `failed` | conservar diagnóstico; limpieza solo explícita si hay incertidumbre |

Crear commits no es idempotente por sí mismo. Antes de repetir se busca un commit con trailers deterministas:

```text
Pi-Subagent-Job: <job-id>
Pi-Subagent-Base: <hash>
```

Si existe exactamente uno y coincide con el árbol esperado, se adopta. Si hay ambigüedad se detiene para revisión.

## Concurrencia y locks

- Lock por `repoRoot` para operaciones de registro/limpieza de worktrees.
- La ejecución de agentes puede continuar en paralelo una vez creados.
- `git worktree prune` nunca se ejecuta globalmente sin inspección; se limita a registros administrados.
- Máximo configurable de worktrees activos, inicialmente igual a concurrencia global.

## Seguridad y autoridad

- Las rutas administradas no aceptan symlinks en componentes de borrado.
- Se valida `realpath` antes de toda eliminación recursiva.
- La rama queda como propuesta; el humano decide inspección y promoción.
- `discard` con cambios requiere confirmación humana y evento auditado.
- No se incluyen diffs completos en eventos.
- Proyecto no confiado no puede solicitar worktree mediante agentes del proyecto.

## Errores

- `WORKTREE_NOT_GIT_REPO`
- `WORKTREE_NO_HEAD`
- `WORKTREE_DIRTY_BASE_INVISIBLE`
- `WORKTREE_CREATE_FAILED`
- `WORKTREE_CWD_UNAVAILABLE`
- `WORKTREE_PRESERVE_FAILED`
- `WORKTREE_CLEANUP_FAILED`
- `WORKTREE_RECOVERY_AMBIGUOUS`

`WORKTREE_DIRTY_BASE_INVISIBLE` puede ser advertencia confirmable, no necesariamente error, pero debe llegar al humano antes de iniciar una revisión de cambios locales.

## Criterios de aceptación

1. Un trabajo aislado nunca ejecuta en cwd principal si falla `worktree add`.
2. El base commit queda fijado al encolar.
3. Cambios del agente sobreviven como rama y el directorio se elimina.
4. Sin cambios no queda rama bajo política predeterminada.
5. Gates corren en el cwd del worktree.
6. Una caída en cada fase se reconcilia sin borrar rutas ajenas.
7. Repetir preservación no crea commits duplicados.
8. El resultado no fusiona ni promueve la rama.
9. Un checkout principal sucio produce advertencia explícita sobre invisibilidad.
10. Dos worktrees del mismo repo pueden ejecutar en paralelo sin corromper registro.

## Pruebas

- Repos sin Git, sin commits, subdirectorios y monorepos.
- Checkout limpio/sucio, cambios staged y untracked.
- Agente sin cambios, con cambios, con commits propios.
- Fallos y timeouts de cada comando Git.
- Recuperación por cada fase persistida.
- Ataques de path traversal y symlink.
- Gates que leen y modifican archivos.
- Migración desde fase 05.

## Fuera de alcance

- Contenedores, sandbox o VM.
- Merge, push, PR o promoción automática.
- Compartir un worktree entre jobs.
- Revisar cambios no confirmados del checkout principal.
