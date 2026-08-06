import { BadRequestException } from '@nestjs/common';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';

/**
 * Unit tests for the controller's optional-listId handling. A present-but-
 * invalid `listId` must be a 400 — NOT silently mapped to `undefined`, which
 * `clearCompleted(undefined)` treats as "every list" and would delete across
 * all of them (scope widening).
 */
describe('TodosController (optional listId scope)', () => {
  let service: jest.Mocked<Pick<TodosService, 'clearCompleted' | 'findAll'>>;
  let controller: TodosController;

  beforeEach(() => {
    service = {
      clearCompleted: jest.fn().mockReturnValue({ deleted: 0 }),
      findAll: jest.fn().mockReturnValue([]),
    };
    controller = new TodosController(service as unknown as TodosService);
  });

  describe('clearCompleted', () => {
    it('scopes to a valid list id', () => {
      controller.clearCompleted('3');
      expect(service.clearCompleted).toHaveBeenCalledWith(3);
    });

    it('treats absent/empty as "all lists" (undefined)', () => {
      controller.clearCompleted(undefined);
      controller.clearCompleted('');
      expect(service.clearCompleted).toHaveBeenNthCalledWith(1, undefined);
      expect(service.clearCompleted).toHaveBeenNthCalledWith(2, undefined);
    });

    it('rejects a present-but-invalid list id instead of widening scope', () => {
      expect(() => controller.clearCompleted('abc')).toThrow(
        BadRequestException,
      );
      expect(() => controller.clearCompleted('0')).toThrow(BadRequestException);
      expect(() => controller.clearCompleted('-2')).toThrow(
        BadRequestException,
      );
      // Crucially, the delete never ran for any of the invalid inputs.
      expect(service.clearCompleted).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('rejects a present-but-invalid list id', () => {
      expect(() => controller.findAll(undefined, 'abc')).toThrow(
        BadRequestException,
      );
    });
  });
});
