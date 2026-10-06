export type ErrorCode =
  | "JOB_NOT_FOUND" | "INVALID_REQUEST" | "AGENT_NOT_FOUND" | "UNSUPPORTED_TOOLS"
  | "MODEL_UNAVAILABLE" | "REQUEST_ID_CONFLICT" | "RUNTIME_CLOSING" | "MIGRATION_REQUIRED"
  | "MIGRATION_DECLINED" | "BACKUP_FAILED" | "STORAGE_VERSION_UNSUPPORTED" | "STORAGE_INCONSISTENT"
  | "STORAGE_BUSY" | "STORAGE_ERROR";

export type AppError = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
};

export type Outcome<T> = { success: true; value: T } | { success: false; error: AppError };

const messages: Record<ErrorCode, string> = {
  JOB_NOT_FOUND: "No existe el trabajo solicitado.", INVALID_REQUEST: "La solicitud no es válida.",
  AGENT_NOT_FOUND: "No existe el agente solicitado.", UNSUPPORTED_TOOLS: "El agente solicita herramientas no soportadas.",
  MODEL_UNAVAILABLE: "El modelo no está disponible.", REQUEST_ID_CONFLICT: "El requestId ya fue usado con otra intención.",
  RUNTIME_CLOSING: "El runtime se está cerrando.", MIGRATION_REQUIRED: "La base requiere una migración autorizada.",
  MIGRATION_DECLINED: "La migración no fue autorizada.", BACKUP_FAILED: "No se pudo crear un backup válido.",
  STORAGE_VERSION_UNSUPPORTED: "La versión de almacenamiento no es compatible.", STORAGE_INCONSISTENT: "El almacenamiento es inconsistente.",
  STORAGE_BUSY: "La base está siendo usada por otro proceso.", STORAGE_ERROR: "No se pudo completar la operación de almacenamiento.",
};

export class DomainError extends Error {
  readonly error: AppError;
  constructor(code: ErrorCode, message = messages[code], retryable = false, details: Record<string, unknown> = {}) {
    super(message); this.name = "DomainError";
    this.error = { code, message, retryable, details };
  }
}

export function failure(error: unknown): Outcome<never> {
  if (error instanceof DomainError) return { success: false, error: error.error };
  return { success: false, error: { code: "STORAGE_ERROR", message: messages.STORAGE_ERROR, retryable: false, details: {} } };
}
