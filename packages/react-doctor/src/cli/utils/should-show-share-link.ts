export interface ShareLinkGateInput {
  readonly noScore: boolean;
  readonly share: boolean;
  readonly isCi: boolean;
}

export const shouldShowShareLink = ({ noScore, share, isCi }: ShareLinkGateInput): boolean =>
  !noScore && share && !isCi;
