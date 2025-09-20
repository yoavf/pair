/**
 * Permission handling types
 */

export interface PermissionRequest {
	driverTranscript: string;
	toolName: string;
	input: Record<string, unknown>;
}

export interface PermissionApproval {
	allowed: true;
	updatedInput: Record<string, unknown>;
	comment?: string;
}

export interface PermissionDenial {
	allowed: false;
	reason: string;
}

export type PermissionResult = PermissionApproval | PermissionDenial;

export interface PermissionOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}
