//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import { DeployLuckyClick } from "./DeployLuckyClick.s.sol";

contract DeployScript is ScaffoldETHDeploy {
    function run() external {
        DeployLuckyClick deployLuckyClick = new DeployLuckyClick();
        deployLuckyClick.run();
    }
}
