import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseIfMatch } from '../common/if-match.js';
import { CasualtiesService } from './casualties.service.js';
import {
  CardPatchDto,
  CreateCasualtyDto,
  CreateFluidDto,
  CreateInjurySiteDto,
  CreateMedicationDto,
  CreateVitalSignsDto,
  ListCasualtiesQueryDto,
  PatchFluidDto,
  PatchInjurySiteDto,
  PatchMedicationDto,
  PatchVitalSignsDto,
  UpsertTourniquetDto,
  type CreateCasualty,
  type CreateFluid,
  type CreateInjurySite,
  type CreateMedication,
  type CreateVitalSigns,
  type ListCasualtiesQuery,
  type PatchFluid,
  type PatchInjurySite,
  type PatchMedication,
  type PatchVitalSigns,
  type UpsertTourniquet,
} from './casualty.schemas.js';
import type { CardPatch } from '@tccc/shared';

@ApiTags('casualties')
@Controller('casualties')
export class CasualtiesController {
  constructor(private readonly casualties: CasualtiesService) {}

  @Get()
  list(@Query() query: ListCasualtiesQueryDto) {
    return this.casualties.list(query as ListCasualtiesQuery);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.casualties.get(id);
  }

  @Post()
  create(@Body() body: CreateCasualtyDto) {
    return this.casualties.create(body as CreateCasualty);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: CardPatchDto,
  ) {
    return this.casualties.update(id, parseIfMatch(ifMatch), body as CardPatch);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string | undefined) {
    return this.casualties.softDelete(id, parseIfMatch(ifMatch));
  }

  @Put(':id/tourniquets/:limb')
  upsertTourniquet(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('limb') limb: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpsertTourniquetDto,
  ) {
    return this.casualties.upsertTourniquet(id, limb, parseIfMatch(ifMatch), body as UpsertTourniquet);
  }

  @Delete(':id/tourniquets/:limb')
  deleteTourniquet(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('limb') limb: string,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.casualties.deleteTourniquet(id, limb, parseIfMatch(ifMatch));
  }

  @Post(':id/injury-sites')
  addInjurySite(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: CreateInjurySiteDto,
  ) {
    return this.casualties.addInjurySite(id, parseIfMatch(ifMatch), body as CreateInjurySite);
  }

  @Patch(':id/injury-sites/:itemId')
  patchInjurySite(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: PatchInjurySiteDto,
  ) {
    return this.casualties.patchInjurySite(id, itemId, parseIfMatch(ifMatch), body as PatchInjurySite);
  }

  @Delete(':id/injury-sites/:itemId')
  deleteInjurySite(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.casualties.deleteInjurySite(id, itemId, parseIfMatch(ifMatch));
  }

  @Post(':id/vitals')
  addVitals(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: CreateVitalSignsDto,
  ) {
    return this.casualties.addVitalSigns(id, parseIfMatch(ifMatch), body as CreateVitalSigns);
  }

  @Patch(':id/vitals/:itemId')
  patchVitals(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: PatchVitalSignsDto,
  ) {
    return this.casualties.patchVitalSigns(id, itemId, parseIfMatch(ifMatch), body as PatchVitalSigns);
  }

  @Delete(':id/vitals/:itemId')
  deleteVitals(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.casualties.deleteVitalSigns(id, itemId, parseIfMatch(ifMatch));
  }

  @Post(':id/fluids')
  addFluid(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: CreateFluidDto,
  ) {
    return this.casualties.addFluid(id, parseIfMatch(ifMatch), body as CreateFluid);
  }

  @Patch(':id/fluids/:itemId')
  patchFluid(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: PatchFluidDto,
  ) {
    return this.casualties.patchFluid(id, itemId, parseIfMatch(ifMatch), body as PatchFluid);
  }

  @Delete(':id/fluids/:itemId')
  deleteFluid(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.casualties.deleteFluid(id, itemId, parseIfMatch(ifMatch));
  }

  @Post(':id/medications')
  addMedication(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: CreateMedicationDto,
  ) {
    return this.casualties.addMedication(id, parseIfMatch(ifMatch), body as CreateMedication);
  }

  @Patch(':id/medications/:itemId')
  patchMedication(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: PatchMedicationDto,
  ) {
    return this.casualties.patchMedication(id, itemId, parseIfMatch(ifMatch), body as PatchMedication);
  }

  @Delete(':id/medications/:itemId')
  deleteMedication(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    return this.casualties.deleteMedication(id, itemId, parseIfMatch(ifMatch));
  }
}
