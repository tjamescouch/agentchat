#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Banner
echo -e "${PURPLE}"
cat << "EOF"
╔═══════════════════════════════════════╗
║                                       ║
║   📦  AGENTCHAT MCP PUBLISHER  📦    ║
║                                       ║
╚═══════════════════════════════════════╝
EOF
echo -e "${NC}"

cd "$(dirname "$0")"

# Get version
VERSION=$(node -p "require('./package.json').version")
echo -e "${CYAN}📋 Package:${NC} @tjamescouch/agentchat-mcp"
echo -e "${CYAN}🏷️  Version:${NC} v${VERSION}"
echo

# Check if already published
echo -e "${YELLOW}🔍 Checking if v${VERSION} is already published...${NC}"
if npm view @tjamescouch/agentchat-mcp@${VERSION} version 2>/dev/null; then
    echo -e "${RED}❌ Version ${VERSION} already exists on npm!${NC}"
    echo -e "${YELLOW}💡 Bump the version in package.json first${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Version ${VERSION} is new!${NC}"
echo

# Show what will be published
echo -e "${CYAN}📦 Files to be published:${NC}"
npm pack --dry-run 2>&1 | grep -E '^\d+\.\d+[kMG]?B' | sed 's/^/   /'
echo

# Validate package
echo -e "${YELLOW}🔍 Validating package...${NC}"
if npm run --silent pack &>/dev/null; then
    echo -e "${GREEN}✅ Package structure looks good!${NC}"
else
    echo -e "${RED}❌ Package validation failed${NC}"
    exit 1
fi
echo

# Get OTP
echo -e "${PURPLE}🔐 Enter your npm 2FA code:${NC}"
read -r OTP

if [ -z "$OTP" ]; then
    echo -e "${RED}❌ OTP is required${NC}"
    exit 1
fi

# Publish!
echo
echo -e "${YELLOW}🚀 Publishing to npm...${NC}"
echo

if npm publish --access public --otp="${OTP}"; then
    echo
    echo -e "${GREEN}"
    cat << "EOF"
    ╔═══════════════════════════════════════╗
    ║                                       ║
    ║       ✨  PUBLISHED!  ✨             ║
    ║                                       ║
    ╔═══════════════════════════════════════╗
EOF
    echo -e "${NC}"
    echo -e "${GREEN}🎉 Successfully published @tjamescouch/agentchat-mcp@${VERSION}${NC}"
    echo -e "${CYAN}📦 Package URL:${NC} https://www.npmjs.com/package/@tjamescouch/agentchat-mcp"
    echo -e "${CYAN}📚 View version:${NC} npm view @tjamescouch/agentchat-mcp@${VERSION}"
    echo
    echo -e "${PURPLE}🤖 Now rebuild your agents:${NC}"
    echo -e "   ${YELLOW}agentctl build${NC}"
    echo -e "   ${YELLOW}agentctl restart peace${NC}"
    echo
else
    echo
    echo -e "${RED}❌ Publish failed!${NC}"
    echo -e "${YELLOW}💡 Check your OTP and try again${NC}"
    exit 1
fi
