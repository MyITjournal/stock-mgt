import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrganizationService } from './organization.service';
import { UpdateOrganizationDto } from './dto/organization.dto';
import { OrganizationView } from './dto/organization.response';

@ApiTags('organization')
@ApiBearerAuth('JWT')
@Controller('organization')
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  @ApiOperation({
    summary: 'The current business and its letterhead',
    description:
      'Readable by every member: a rep issuing an invoice needs the details that go on it.',
  })
  @ApiOkResponse({ type: OrganizationView })
  current() {
    return this.organization.current();
  }

  @Patch()
  @Roles(OrgRole.owner, OrgRole.manager)
  @ApiOperation({
    summary: 'Update the business details printed on documents',
    description:
      'Every field is optional and may be cleared. `currency`, `timezone` and invoice numbering are **not** editable here: periods resolve in the timezone, and rewinding the invoice counter would produce duplicate numbers.',
  })
  @ApiOkResponse({ type: OrganizationView })
  update(@Body() dto: UpdateOrganizationDto) {
    return this.organization.update(dto);
  }
}
