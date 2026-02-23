// src/middleware/validation/workingHours.validation.ts
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../utils/response';

export const validateWorkingHours = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const { workingHours } = req.body;

  if (!workingHours) {
    return next(new ApiError(400, 'Working hours are required'));
  }

  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

  for (const day of days) {
    if (workingHours[day]) {
      const schedule = workingHours[day];
      
      if (!schedule.start || !schedule.end) {
        return next(new ApiError(400, `Start and end times are required for ${day}`));
      }
      
      if (!timeRegex.test(schedule.start) || !timeRegex.test(schedule.end)) {
        return next(new ApiError(400, `Invalid time format for ${day}. Use HH:MM (24-hour format)`));
      }
      
      // Parse times
      const [startHour, startMinute] = schedule.start.split(':').map(Number);
      const [endHour, endMinute] = schedule.end.split(':').map(Number);
      
      // Validate time range
      if (startHour < 0 || startHour > 23 || startMinute < 0 || startMinute > 59) {
        return next(new ApiError(400, `Invalid start time for ${day}`));
      }
      
      if (endHour < 0 || endHour > 23 || endMinute < 0 || endMinute > 59) {
        return next(new ApiError(400, `Invalid end time for ${day}`));
      }
      
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;
      
      if (endMinutes <= startMinutes) {
        return next(new ApiError(400, `End time must be after start time for ${day}`));
      }
    }
  }

  next();
};