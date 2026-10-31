
export interface Clock {
    now(): Date
}

export const systemClock: Clock = {now: () => new Date() }

export function fixedClock(iso:string):Clock {
    const date = new Date(iso)
    return {now : () => new Date(date) }
}