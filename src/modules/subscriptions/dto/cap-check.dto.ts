import { IsIn, IsString } from 'class-validator';

export class CapCheckDto {
  @IsString()
  userId: string;

  @IsIn(['application_outbound', 'inbound_proposal', 'ai_tool'])
  feature: 'application_outbound' | 'inbound_proposal' | 'ai_tool';
}
