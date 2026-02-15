// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import "../contracts/TenTwentyFourX.sol";

contract DeployTenTwentyFourX is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // CLAWD token on Base
        address clawd = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;
        // Owner: clawdbotatg.eth
        address owner = 0x11ce532845cE0eAcdA41f72FDc1C88c335981442;
        new TenTwentyFourX(clawd, owner);
    }
}
