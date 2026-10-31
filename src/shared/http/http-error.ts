import {unknown} from "zod";

export class HttpError extends Error {
    constructor(
        readonly statusCode: number,
        message: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = new.target.name
    }
}

export class BadRequestError extends HttpError {
    constructor(message= "Bad Request", details: unknown) {
        super(400, message, details);
    }
}

export class UnauthorizedError extends HttpError {
    constructor(message= "Unauthorized") {
        super(401, message);
    }
}

export class ForbiddenError extends HttpError {
    constructor(message= "Forbidden") {
        super(403, message);
    }
}

export class NotFoundError extends HttpError {
    constructor(message= "Not Found") {
        super(404, message);
    }
}

export class ConflictError extends HttpError {
    constructor(message= 'Conflict') {
        super(409,message);
    }
}

export class PayloadToLargeError extends HttpError {
    constructor(message= "Payload is to large") {
        super(413, message);
    }
}

export class UnprocessableEntityError extends HttpError {
    constructor(message= "Unprocessable Entity", details?:unknown) {
        super(422, message, details);
    }
}

export class UnsupportedMediaTypeError extends HttpError {
    constructor(message= "Unsupported Media type") {
        super(415, message);
    }
}