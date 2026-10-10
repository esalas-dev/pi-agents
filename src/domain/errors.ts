export type ErrorCode =
  | "JOB_NOT_FOUND" | "INVALID_REQUEST" | "AGENT_NOT_FOUND" | "UNSUPPORTED_TOOLS"
  | "MODEL_UNAVAILABLE" | "REQUEST_ID_CONFLICT" | "RUNTIME_CLOSING" | "MIGRATION_REQUIRED"
  | "MIGRATION_DECLINED" | "BACKUP_FAILED" | "STORAGE_VERSION_UNSUPPORTED" | "STORAGE_INCONSISTENT"
  | "STORAGE_BUSY" | "STORAGE_ERROR" | "INVALID_FILTER" | "WAIT_TIMEOUT" | "WAIT_ABORTED"
  | "RESULT_NOT_READY" | "RESULT_REVIEW_REQUIRED" | "RESULT_REJECTED"
  | "PAUSE_ACTIVE_UNSUPPORTED" | "CONTROL_INVALID_STATE" | "CONTROL_NOT_AUTHORIZED" | "CONTROL_CONFLICT" | "RETRY_NOT_ALLOWED"
  | "ACTIVE_CANCEL_CONFIRMATION_REQUIRED";

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
  INVALID_FILTER: "El filtro de consulta no es válido.", WAIT_TIMEOUT: "La espera agotó su tiempo límite.",
  WAIT_ABORTED: "La espera fue abortada.", RESULT_NOT_READY: "El resultado todavía no está disponible.",
  RESULT_REVIEW_REQUIRED: "El resultado requiere revisión humana.", RESULT_REJECTED: "El resultado fue rechazado.",
  PAUSE_ACTIVE_UNSUPPORTED: "La pausa activa no está soportada por la API pública de Pi Durable.", CONTROL_INVALID_STATE: "El trabajo no admite esta operación de control en su estado actual.", CONTROL_NOT_AUTHORIZED: "El actor no está autorizado para controlar este trabajo.", CONTROL_CONFLICT: "La operación de control entra en conflicto con una solicitud existente.", RETRY_NOT_ALLOWED: "El trabajo no admite retry en su estado actual.", ACTIVE_CANCEL_CONFIRMATION_REQUIRED: "La cancelación requiere confirmación activa.",
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
