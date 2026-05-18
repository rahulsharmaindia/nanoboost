export class ErrorEnvelopeDto {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
