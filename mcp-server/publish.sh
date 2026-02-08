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
if npm pack --dry-run &>/dev/null; then
    echo -e "${GREEN}✅ Package structure looks good!${NC}"
else
    echo -e "${RED}❌ Package validation failed${NC}"
    exit 1
fi
echo

# Publish with retry
MAX_ATTEMPTS=3
ATTEMPT=1
SUCCESS=false

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    echo -e "${PURPLE}🔐 Enter your npm 2FA code (attempt $ATTEMPT/$MAX_ATTEMPTS):${NC}"
    echo -e "${YELLOW}💡 Get a FRESH code from your authenticator (refreshes every 30s)${NC}"
    read -r OTP

    if [ -z "$OTP" ]; then
        echo -e "${RED}❌ OTP is required${NC}"
        continue
    fi

    echo
    echo -e "${YELLOW}🚀 Publishing to npm...${NC}"
    echo

    if npm publish --access public --otp="${OTP}" 2>&1; then
        SUCCESS=true
        break
    else
        ATTEMPT=$((ATTEMPT + 1))
        if [ $ATTEMPT -le $MAX_ATTEMPTS ]; then
            echo
            echo -e "${YELLOW}⚠️  Publish failed. Common reasons:${NC}"
            echo -e "   • OTP expired (get a fresh one!)"
            echo -e "   • Typo in code"
            echo -e "   • Network hiccup"
            echo
            echo -e "${CYAN}🔄 Try again with a NEW code...${NC}"
            sleep 2
        fi
    fi
done

if [ "$SUCCESS" = true ]; then
    echo
    echo -e "${GREEN}"
    cat << "EOF"
    ╔═══════════════════════════════════════╗
    ║                                       ║
    ║       ✨  PUBLISHED!  ✨             ║
    ║                                       ║
    ╚═══════════════════════════════════════╝
EOF
    echo -e "${NC}"
    echo -e "${GREEN}🎉 Successfully published @tjamescouch/agentchat-mcp@${VERSION}${NC}"
    echo -e "${CYAN}📦 Package URL:${NC} https://www.npmjs.com/package/@tjamescouch/agentchat-mcp"
    echo -e "${CYAN}📚 View version:${NC} npm view @tjamescouch/agentchat-mcp@${VERSION}"
    echo
    echo -e "${PURPLE}🤖 Now rebuild your agents:${NC}"
    echo -e "   ${YELLOW}agentctl build${NC}"
    echo -e "   ${YELLOW}AGENTCHAT_URL=wss://agentchat-dashboard.fly.dev agentctl restart peace${NC}"
    echo
else
    echo
    echo -e "${RED}❌ Publish failed after $MAX_ATTEMPTS attempts!${NC}"
    echo -e "${YELLOW}💡 Wait 30 seconds for a fresh OTP, then try: ./publish.sh${NC}"
    exit 1
fi
