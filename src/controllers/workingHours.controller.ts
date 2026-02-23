import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { ApiError, ApiResponse } from '../utils/response';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// Define types for working hours
interface DaySchedule {
  start: string;
  end: string;
  isAvailable: boolean;
}

interface WorkingHours {
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
  sunday?: DaySchedule;
}

// Default working hours
const defaultWorkingHours: WorkingHours = {
  monday: { start: '09:00', end: '17:00', isAvailable: true },
  tuesday: { start: '09:00', end: '17:00', isAvailable: true },
  wednesday: { start: '09:00', end: '17:00', isAvailable: true },
  thursday: { start: '09:00', end: '17:00', isAvailable: true },
  friday: { start: '09:00', end: '17:00', isAvailable: true },
  saturday: { start: '10:00', end: '14:00', isAvailable: false },
  sunday: { start: '10:00', end: '14:00', isAvailable: false }
};

// @desc    Set vet working hours
// @route   PUT /api/v1/vets/working-hours
// @access  Private (Vet only)
export const setWorkingHours = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can set working hours');
    }

    const { workingHours } = req.body;

    // Validate working hours structure
    if (!workingHours || typeof workingHours !== 'object') {
      throw new ApiError(400, 'Working hours must be an object');
    }

    // Validate each day's schedule
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    
    for (const day of days) {
      if (workingHours[day]) {
        const schedule = workingHours[day];
        
        if (!schedule.start || !schedule.end) {
          throw new ApiError(400, `Start and end times are required for ${day}`);
        }
        
        // Validate time format (HH:MM)
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(schedule.start) || !timeRegex.test(schedule.end)) {
          throw new ApiError(400, `Invalid time format for ${day}. Use HH:MM format`);
        }
        
        // Convert times to minutes for comparison
        const [startHour, startMinute] = schedule.start.split(':').map(Number);
        const [endHour, endMinute] = schedule.end.split(':').map(Number);
        
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;
        
        if (endMinutes <= startMinutes) {
          throw new ApiError(400, `End time must be after start time for ${day}`);
        }
      }
    }

    // Get vet profile
    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    // Update working hours - use type assertion since field may not exist yet
    const updatedVet = await prisma.vet.update({
      where: { userId: req.user.id },
      data: {
        workingHours: workingHours as any  // Type assertion for now
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    logger.info(`Working hours updated for vet: ${vet.id}`);

    // Cast to any to access workingHours
    const vetWithHours = updatedVet as any;
    
    res.status(200).json(
      new ApiResponse(200, 'Working hours updated successfully', {
        workingHours: vetWithHours.workingHours || workingHours
      })
    );
  } catch (error: any) {
    logger.error('Error setting working hours:', error);
    next(error);
  }
};

// @desc    Get vet working hours
// @route   GET /api/v1/vets/working-hours
// @access  Private (Vet only)
export const getWorkingHours = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can view working hours');
    }

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id },
      select: {
        id: true,
        // workingHours: true  // Will work after adding to schema
      }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    // Cast to any to access workingHours if they exist
    const vetWithHours = vet as any;
    const workingHours = vetWithHours.workingHours || defaultWorkingHours;

    res.status(200).json(
      new ApiResponse(200, 'Working hours retrieved', { workingHours })
    );
  } catch (error: any) {
    logger.error('Error getting working hours:', error);
    next(error);
  }
};

// @desc    Get vet's working hours by vet ID (public)
// @route   GET /api/v1/vets/:id/working-hours
// @access  Private
export const getVetWorkingHoursById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const vet = await prisma.vet.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    if (!vet) {
      throw new ApiError(404, 'Veterinarian not found');
    }

    // Cast to any to access workingHours
    const vetWithHours = vet as any;
    const workingHours = vetWithHours.workingHours || defaultWorkingHours;

    res.status(200).json(
      new ApiResponse(200, 'Working hours retrieved', {
        vetId: vet.id,
        vetName: `${vet.user.firstName} ${vet.user.lastName}`,
        workingHours
      })
    );
  } catch (error: any) {
    logger.error('Error getting vet working hours by ID:', error);
    next(error);
  }
};

// Temporary workaround until schema is updated
// This function can be called after the schema is updated
export const addWorkingHoursToAllVets = async () => {
  try {
    const allVets = await prisma.vet.findMany();
    
    for (const vet of allVets) {
      const vetWithHours = vet as any;
      if (!vetWithHours.workingHours) {
        await prisma.vet.update({
          where: { id: vet.id },
          data: {
            workingHours: defaultWorkingHours as any
          }
        });
      }
    }
    
    logger.info('Default working hours added to all vets');
  } catch (error) {
    logger.error('Error adding working hours to vets:', error);
  }
};