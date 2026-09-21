import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { BookingRepository } from "../../repositories/bookingRepository.js";
import { ExternalCalendarRepository } from "../../repositories/externalCalendarRepository.js";
import { SchedulingConfigurationRepository } from "../../repositories/schedulingConfigurationRepository.js";
import { SchedulingRepository } from "../../repositories/schedulingRepository.js";

export function createAsyncSchedulingPersistence(database: SqlDatabase): Readonly<{
  booking: BookingRepository;
  externalCalendar: ExternalCalendarRepository;
  configuration: SchedulingConfigurationRepository;
  scheduling: SchedulingRepository;
}> {
  return Object.freeze({
    booking: new BookingRepository(database),
    externalCalendar: new ExternalCalendarRepository(database),
    configuration: new SchedulingConfigurationRepository(database),
    scheduling: new SchedulingRepository(database),
  });
}
