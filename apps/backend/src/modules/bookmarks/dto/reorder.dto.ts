import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsPositive,
} from 'class-validator';

export class ReorderDto {
  /**
   * Every sibling in the folder, in its new order.
   *
   * "Every sibling" is enforced server-side too (see `checkReorder`): brief 73's
   * bug was a reorder from a filtered view stamping positions over rows the caller
   * could not see, and a DTO alone cannot tell a complete list from a subset.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  ids: number[];
}
