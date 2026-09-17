import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { StaffService } from './staff.service';
import {
  CreateStaffDto,
  ResetStaffPasswordDto,
  UpdateStaffDto,
} from './dto/staff.dto';

/**
 * Who works here.
 *
 * **Writes are owner-only.** A manager is a staff role like any other: they may
 * post a stocktake and override a credit sale, but hiring, firing and handing
 * out roles is the owner's. Reading the list is open to every member, because a
 * rep needs to know who to hand a sale over to.
 */
@ApiTags('staff')
@ApiBearerAuth('JWT')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @ApiOperation({ summary: 'Everyone who works in this business' })
  list() {
    return this.staff.list();
  }

  @Post()
  @Roles(OrgRole.owner)
  @Idempotent(
    'A retry with the same key returns the original staff member instead of creating a second account.',
  )
  @ApiOperation({
    summary: 'Add a member of staff',
    description:
      'You set their password and tell them: most cashiers have no email to send it to, so the account is created already verified rather than waiting for a code that would never arrive. Give a `username` for staff without an address — it is stored qualified by your shop, so "amina" becomes `amina@your-slug` and another business can still have an Amina.',
  })
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }

  @Patch(':userId')
  @Roles(OrgRole.owner)
  @ApiOperation({
    summary: 'Change what someone may do, or suspend and restore them',
    description:
      'You cannot change your own role or suspend yourself, and the last remaining owner cannot be demoted or suspended — a business with no owner has nobody who can manage staff. Restoring somebody needs a free seat.',
  })
  update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser('sub') actingUserId: string,
  ) {
    return this.staff.update(userId, dto, actingUserId);
  }

  @Post(':userId/password')
  @Roles(OrgRole.owner)
  @ApiOperation({
    summary: 'Set a new password for a member of staff',
    description:
      'Staff without an email address cannot use the self-service reset, so somebody has to be able to do it for them.',
  })
  resetPassword(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ResetStaffPasswordDto,
  ) {
    return this.staff.resetPassword(userId, dto);
  }

  @Delete(':userId')
  @Roles(OrgRole.owner)
  @ApiOperation({
    summary: 'Remove someone who has left',
    description:
      'Suspends rather than deletes: their name is on sales, payments and stock movements. It takes effect on their **next request**, not when their token expires, and it frees their seat.',
  })
  remove(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser('sub') actingUserId: string,
  ) {
    return this.staff.suspend(userId, actingUserId);
  }
}
