/** Build-time opt-in; authorization remains enforced by the existing API. */
export const operationsPreviewEnabled = import.meta.env.VITE_OPERATIONS_PREVIEW === 'true'
