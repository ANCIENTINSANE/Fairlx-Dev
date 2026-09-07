import {
  colors,
  typography,
  createEmailWrapper,
  createPrimaryButton,
  createSecondaryButton,
  createNotificationBadge,
  createContentCard,
} from "./theme";

interface StandinApprovalParams {
  userName: string;
  actorName: string;
  taskName: string;
  draft: string;
  reason: string;
  trigger: string;
  approveUrl: string;
  selfUrl: string;
  taskUrl: string;
}

export function standinApprovalTemplate({
  userName,
  actorName,
  taskName,
  draft,
  reason,
  trigger,
  approveUrl,
  selfUrl,
  taskUrl,
}: StandinApprovalParams): string {
  const triggerLabel = trigger === "assignment" ? "assigned you a work item" : "tagged you on a work item";
  let content = "";
  content += createNotificationBadge("✉️", "Personal Agent draft", colors.infoLight, colors.infoDark);
  content += `
    <h1 style="margin: 0 0 12px 0; font-size: ${typography.sizes.h2}; font-weight: ${typography.weights.bold}; color: ${colors.darkText}; line-height: ${typography.lineHeight.tight}; font-family: ${typography.fontStack};">
      Hi ${userName}, your Personal Agent drafted a reply
    </h1>
    <p style="margin: 0 0 16px 0; font-size: ${typography.sizes.body}; color: ${colors.bodyText}; line-height: ${typography.lineHeight.relaxed}; font-family: ${typography.fontStack};">
      ${actorName} ${triggerLabel}: <strong style="color: ${colors.primaryBlue};">${taskName}</strong>.
      This needs you before it can post.
    </p>
  `;
  if (reason) {
    content += `<p style="margin: 0 0 16px 0; font-size: ${typography.sizes.small}; color: ${colors.bodyText}; font-family: ${typography.fontStack};">${reason}</p>`;
  }
  content += createContentCard(draft.replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
  content += createPrimaryButton("Approve — post this reply", approveUrl);
  content += createSecondaryButton("I'll answer myself", selfUrl);
  content += `
    <p style="margin: 8px 0 0 0; font-size: ${typography.sizes.small}; color: ${colors.bodyText}; font-family: ${typography.fontStack};">
      <a href="${taskUrl}" style="color: ${colors.primaryBlue};">Open the work item in Fairlx</a>
    </p>
  `;
  return createEmailWrapper(content, `Personal Agent draft on ${taskName}`);
}
