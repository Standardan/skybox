/** Thrown when an addon's HTTP response doesn't conform to the Stremio addon protocol. */
export class AddonProtocolError extends Error {
  constructor(
    message: string,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "AddonProtocolError";
  }
}
