#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

echo -e "${PURPLE}"
cat << "EOF"
╔═══════════════════════════════════════╗
║   🤖  NPM AUTOMATION SETUP  🤖       ║
╚═══════════════════════════════════════╝
EOF
echo -e "${NC}"

echo -e "${CYAN}Step 1: Opening npm token creation page...${NC}"
sleep 1
open "https://www.npmjs.com/settings/$(npm whoami 2>/dev/null || echo 'YOUR_USERNAME')/tokens/new" 2>/dev/null || echo "Please open: https://www.npmjs.com/settings/YOUR_USERNAME/tokens/new"

echo
echo -e "${YELLOW}📝 On the npm page:${NC}"
echo "   1. Select 'Automation' token type"
echo "   2. Give it a name: 'GitHub Actions - agentchat'"
echo "   3. Click 'Generate Token'"
echo "   4. Copy the token (starts with npm_...)"
echo

read -p "Press ENTER when you have copied the token..."

echo
echo -e "${CYAN}Step 2: Opening GitHub secrets page...${NC}"
sleep 1
open "https://github.com/tjamescouch/agentchat/settings/secrets/actions/new" 2>/dev/null || echo "Please open: https://github.com/tjamescouch/agentchat/settings/secrets/actions/new"

echo
echo -e "${YELLOW}📝 On the GitHub page:${NC}"
echo "   1. Name: NPM_TOKEN"
echo "   2. Value: Paste the npm token"
echo "   3. Click 'Add secret'"
echo

read -p "Press ENTER when you've added the secret..."

echo
echo -e "${CYAN}Step 3: Triggering publish workflow...${NC}"
cd "$(dirname "$0")/.."
git commit --allow-empty -m "Trigger MCP publish workflow [ci skip]"
git push

echo
echo -e "${GREEN}✨ Done! Workflow triggered!${NC}"
echo
echo -e "${CYAN}📺 Watch the workflow:${NC}"
echo "   https://github.com/tjamescouch/agentchat/actions"
echo

sleep 2
open "https://github.com/tjamescouch/agentchat/actions" 2>/dev/null || true

echo -e "${YELLOW}⏳ Waiting for workflow to start...${NC}"
sleep 5

echo
echo -e "${PURPLE}🔍 Checking workflow status...${NC}"
gh run list --workflow=publish-mcp.yml --limit 1 2>/dev/null || echo "Install gh CLI to see status: brew install gh"
