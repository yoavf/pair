/**
 * Permission handling error types
 */

export class PermissionTimeoutError extends Error {
	constructor(message = "Permission request timed out") {
		super(message);
		this.name = "PermissionTimeoutError";
	}
}

export class PermissionDeniedError extends Error {
	constructor(
		public readonly reason: string,
		message = "Permission denied by navigator",
	) {
		super(message);
		this.name = "PermissionDeniedError";
	}
}

export class PermissionMalformedError extends Error {
	constructor(message = "Navigator provided malformed permission response") {
		super(message);
		this.name = "PermissionMalformedError";
	}
}

export class NavigatorSessionError extends Error {
	constructor(message = "Navigator session error") {
		super(message);
		this.name = "NavigatorSessionError";
	}
}
