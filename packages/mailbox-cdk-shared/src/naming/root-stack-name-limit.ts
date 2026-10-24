/**
 * The longest root stack name a stack deployment accepts. CloudFormation truncates auto-generated physical
 * names to 64 characters, and the names built from the root stack name must stay inside that, so the stack
 * deployer rejects a longer name and the physical name builder reserves this length.
 */
export const MAX_ROOT_STACK_NAME_LENGTH = 24;
