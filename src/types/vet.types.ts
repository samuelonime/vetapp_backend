// src/types/vet.types.ts
export interface WorkingHours {
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
  sunday?: DaySchedule;
}

export interface DaySchedule {
  start: string; // Format: "09:00"
  end: string;   // Format: "17:00"
  isAvailable: boolean;
}