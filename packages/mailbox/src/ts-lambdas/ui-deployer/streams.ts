export async function streamToBuffer(stream: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      continue;
    }

    // Node streams typically emit Buffer/Uint8Array; handle both.
    chunks.push(Buffer.from(chunk as any));
  }

  return Buffer.concat(chunks);
}
