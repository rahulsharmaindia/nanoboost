// ── Brands controller ────────────────────────────────────────

import { Controller, Post, Get, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { BrandsService } from './brands.service';
import { RegisterBrandDto } from './dto/register-brand.dto';
import { LoginBrandDto } from './dto/login-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { BrandAuthGuard } from '../../common/guards/brand-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

@Controller('api/brand')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  // POST /api/brand/register
  @Public()
  @Post('register')
  register(@Body() dto: RegisterBrandDto) {
    return this.brandsService.register(dto);
  }

  // POST /api/brand/login
  @Public()
  @Post('login')
  login(@Body() dto: LoginBrandDto) {
    return this.brandsService.login(dto);
  }

  // GET /api/brand
  @UseGuards(BrandAuthGuard)
  @Get()
  getProfile(@Req() req: Request) {
    return this.brandsService.getProfile((req as any).sessionId);
  }

  // PATCH /api/brand
  @UseGuards(BrandAuthGuard)
  @Patch()
  updateProfile(@Req() req: Request, @Body() dto: UpdateBrandDto) {
    return this.brandsService.updateProfile((req as any).sessionId, dto);
  }
}
