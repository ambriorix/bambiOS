import styled from "styled-components";

const StyledStatusBar = styled.footer`
  align-items: center;
  background-color: rgb(51, 51, 51);
  color: #fff;
  display: flex;
  font-size: 12px;
  font-weight: 100;
  height: 23px;
  padding: 0 5px;
  width: 100%;

  div {
    margin-top: -1px;
    padding: 0 10px;

    &::after {
      border-right-color: #fff;
      border-right-style: solid;
      border-right-width: 1px;
      bottom: 6px;
      content: "";
      height: 11px;
      margin-left: 10px;
      position: absolute;
    }
  }
`;

export default StyledStatusBar;
