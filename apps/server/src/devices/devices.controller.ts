import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DevicesService } from './devices.service.js';
import { RegisterDeviceDto, type RegisterDevice } from './register-device.schema.js';

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('register')
  register(@Body() body: RegisterDeviceDto) {
    return this.devices.register(body as RegisterDevice);
  }
}
