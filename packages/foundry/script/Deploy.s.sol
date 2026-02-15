//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import { DeployTenTwentyFourX } from "./DeployTenTwentyFourX.s.sol";

contract DeployScript is ScaffoldETHDeploy {
    function run() external {
        DeployTenTwentyFourX deployTenTwentyFourX = new DeployTenTwentyFourX();
        deployTenTwentyFourX.run();
    }
}
