import { ENUMS } from '@tccc/shared';
import * as prismaEnums from '../generated/prisma/enums.js';

describe('shared enums mirror the Prisma schema', () => {
  it('declares the same enum names', () => {
    expect(Object.keys(ENUMS).sort()).toEqual(Object.keys(prismaEnums).sort());
  });

  it.each(Object.keys(ENUMS))('%s has identical members', (name) => {
    const shared = ENUMS[name as keyof typeof ENUMS];
    const prisma = prismaEnums[name as keyof typeof prismaEnums];
    expect(shared).toEqual(prisma);
  });
});
