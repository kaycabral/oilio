import { type BusinessHours, EMPTY_BUSINESS_HOURS } from '@/domain'

export function defaultFirstUnitHours(): BusinessHours {
  const weekday = [{ open: '09:00', close: '18:00' }]
  return {
    ...EMPTY_BUSINESS_HOURS,
    monday: [...weekday],
    tuesday: [...weekday],
    wednesday: [...weekday],
    thursday: [...weekday],
    friday: [...weekday],
    saturday: [...weekday],
    sunday: null,
  }
}
