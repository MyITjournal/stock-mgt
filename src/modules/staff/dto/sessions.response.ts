import { ApiProperty } from '@nestjs/swagger';

/**
 * Who is signed in (2026-10-08). The service's declared return type, not a
 * description of it (DECISIONS.md §17).
 */
export class SessionView {
  @ApiProperty({ example: 'Chrome on Android' })
  device!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  signedInAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'The last renewal. The app renews every fifteen minutes while it is used, so the person was last active at or up to fifteen minutes after this.',
  })
  lastActiveAt!: Date;

  @ApiProperty({ description: 'Renewed within the last thirty minutes.' })
  activeNow!: boolean;
}

export class MemberSessionsView {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({
    type: () => [SessionView],
    description: 'Live sessions in this shop, most recently active first.',
  })
  sessions!: SessionView[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'The last renewal on record; null when none is kept.',
  })
  lastSeenAt!: Date | null;
}

export class SessionsSummaryView {
  @ApiProperty({ type: () => [MemberSessionsView] })
  members!: MemberSessionsView[];

  @ApiProperty({ description: 'People with a session active now.' })
  activePeople!: number;

  @ApiProperty({ description: 'Sessions active now, across everybody.' })
  activeDevices!: number;
}
