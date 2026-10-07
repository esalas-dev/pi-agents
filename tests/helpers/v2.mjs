import { JobsIndexDoc, StorageMetaDoc } from '../../src/infrastructure/durable/documents.ts';

export async function seedSchema2(session, context) {
  await session.commit(async tx => {
    const meta = await tx.doc(StorageMetaDoc);
    meta.storageSchemaVersion = 2;
    const index = await tx.doc(JobsIndexDoc);
    index.storageSchemaVersion = 2;
  }, context);
}
